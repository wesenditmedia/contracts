// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Arrays.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";

import "./StakingPoolSnapshot.sol";
import "./EmergencyGuard.sol";
import "./interfaces/IStakingPool.sol";
import "./utils/WeSenditMath.sol";
import "./utils/Trigonometry.sol";
import "./interfaces/IWeStakeitToken.sol";

import "hardhat/console.sol";

abstract contract BaseStakingPool is
    IStakingPool,
    StakingPoolSnapshot,
    EmergencyGuard,
    Ownable,
    AccessControlEnumerable,
    ReentrancyGuard
{
    // Role allowed to do admin operations like pausing and emergency withdrawal.
    bytes32 public constant ADMIN = keccak256("ADMIN");

    // Role allowed to update allocatedPoolShares
    bytes32 public constant UPDATE_ALLOCATED_POOL_SHARES =
        keccak256("UPDATE_ALLOCATED_POOL_SHARES");

    // Rewards in token per second
    // Calculation: Max. rewards per 364 days / 31_449_600 (seconds per 364 days)
    uint256 public constant TOKEN_PER_SECOND = 7654263202075702075;

    // Initial pool token balance
    uint256 internal constant INITIAL_POOL_BALANCE = 120_000_000 ether;

    // Seconds per day
    uint256 internal constant SECONDS_PER_DAY = 86400;

    // Seconds per hour
    uint256 internal constant SECONDS_PER_HOUR = 3600;

    // Indicator, if pool is paused (no stake, no unstake, no claim)
    bool internal _poolPaused = false;

    // Indicator, if user emergency unstake is enabled
    bool internal _emergencyUnstakeEnabled = false;

    // Current pool factor, updated on every updatePool() call
    uint256 internal _currentPoolFactor = 100 ether;

    // Timestamp of last block rewards were calculated
    uint256 internal _lastRewardTimestamp;

    // Amount of allocated pool shares
    uint256 internal _allocatedPoolShares;

    // Amount of active allocated pool shares
    uint256 internal _activeAllocatedPoolShares;

    // Timestamp of last block active allocated pool shares were updated
    uint256 internal _lastActiveAllocatedPoolSharesTimestamp;

    // Amount of accured rewards per share, updated on every updatePool() call
    uint256 internal _accRewardsPerShare;

    // Total amount of locked token (excluding rewards)
    uint256 internal _totalTokenLocked;

    // Amount of reserved rewards (claimed, but no unstake yet = no reduction of shares)
    uint256 internal _reservedRewards;

    // Amount of reserved fees (collected, but not withdrawn yet)
    uint256 internal _reservedFees;

    // Token used for staking
    IERC20 private _stakeToken = IERC20(address(0));

    // Token used as staking proof
    IWeStakeitToken private _proofToken = IWeStakeitToken(address(0));

    // Mapping of proof token to staking entry
    mapping(uint256 => PoolEntry) internal _poolEntries;

    /**
     * Checks if tokenId owner equals sender
     *
     * @param tokenId uint256 - Proof token ID
     */
    modifier onlyTokenOwner(uint256 tokenId) {
        require(
            proofToken().ownerOf(tokenId) == _msgSender(),
            "Staking Pool: Caller is not entry owner"
        );
        _;
    }

    /**
     * Checks if pool is paused
     */
    modifier onlyUnpaused() {
        require(
            !poolPaused(),
            "Staking Pool: Pool operations are currently paused"
        );
        _;
    }

    constructor(address stakeTokenAddress, address proofTokenAddress) {
        // Add creator to admin role
        _setupRole(ADMIN, _msgSender());

        // Set role admin for roles
        _setRoleAdmin(ADMIN, ADMIN);
        _setRoleAdmin(UPDATE_ALLOCATED_POOL_SHARES, ADMIN);

        // Setup token
        _stakeToken = IERC20(stakeTokenAddress);
        _proofToken = IWeStakeitToken(proofTokenAddress);
    }

    // Emergency functions
    function emergencyWithdraw(
        uint256 amount
    ) external override onlyRole(ADMIN) {
        super._emergencyWithdraw(amount);
    }

    function emergencyWithdrawToken(
        address token,
        uint256 amount
    ) external override onlyRole(ADMIN) {
        require(
            amount <=
                stakeToken().balanceOf(address(this)) - totalTokenLocked(),
            "Staking Pool: Withdraw amount exceeds available balance"
        );

        super._emergencyWithdrawToken(token, amount);
    }

    function withdrawFee() external onlyRole(ADMIN) {
        stakeToken().transfer(_msgSender(), _reservedFees);

        _reservedFees = 0;
    }

    function setPoolPaused(bool value) external onlyRole(ADMIN) {
        _poolPaused = value;
    }

    function setEmergencyUnstakeEnabled(bool value) external onlyRole(ADMIN) {
        _emergencyUnstakeEnabled = value;
    }

    function setActiveAllocatedPoolShares(
        uint256 value
    ) external onlyRole(UPDATE_ALLOCATED_POOL_SHARES) {
        _activeAllocatedPoolShares = value;
        _lastActiveAllocatedPoolSharesTimestamp = block.timestamp;
    }

    function setReservedRewards(
        uint256 value
    ) external onlyRole(UPDATE_ALLOCATED_POOL_SHARES) {
        _reservedRewards = value;
    }

    function setReservedFees(
        uint256 value
    ) external onlyRole(UPDATE_ALLOCATED_POOL_SHARES) {
        _reservedFees = value;
    }

    function apy(uint256 duration) external view returns (uint256 value) {
        return apy(duration, poolFactor(poolBalance()));
    }

    function apr(uint256 duration) external view returns (uint256 value) {
        return apr(duration, poolFactor(poolBalance()));
    }

    function poolPaused() public view returns (bool value) {
        return _poolPaused;
    }

    function emergencyUnstakeEnabled() public view returns (bool value) {
        return _emergencyUnstakeEnabled;
    }

    function currentPoolFactor() public view returns (uint256 value) {
        return _currentPoolFactor;
    }

    function lastRewardTimestamp() public view returns (uint256 value) {
        return _lastRewardTimestamp;
    }

    function allocatedPoolShares() public view returns (uint256 value) {
        return _allocatedPoolShares;
    }

    function activeAllocatedPoolShares() public view returns (uint256 value) {
        return _activeAllocatedPoolShares;
    }

    function lastActiveAllocatedPoolSharesTimestamp()
        public
        view
        returns (uint256 value)
    {
        return _lastActiveAllocatedPoolSharesTimestamp;
    }

    function accRewardsPerShare() public view returns (uint256 value) {
        return _accRewardsPerShare;
    }

    function totalPoolShares() public pure returns (uint256 value) {
        // Total possible shares per 364 days
        // Calculation: 120_000_000 * 200.60293 (max. APY)
        return 240_723_516 * 1e2;
    }

    function totalTokenLocked() public view returns (uint256 value) {
        return _totalTokenLocked;
    }

    function reservedRewards() public view returns (uint256 value) {
        return _reservedRewards;
    }

    function reservedFees() public view returns (uint256 value) {
        return _reservedFees;
    }

    function minDuration() public pure override returns (uint256 duration) {
        return 7;
    }

    function maxDuration() public pure returns (uint256 value) {
        return 364; // 52 weeks
    }

    function compoundInterval() public pure returns (uint256 value) {
        return 730;
    }

    function stakeToken() public view returns (IERC20 value) {
        return _stakeToken;
    }

    function proofToken() public view returns (IWeStakeitToken value) {
        return _proofToken;
    }

    function poolBalance() public view returns (uint256 value) {
        return poolBalance(currentPoolFactor());
    }

    function poolBalance(
        uint256 poolFactor_
    ) public view returns (uint256 value) {
        // Get current pool balance
        uint256 tokenBalance = stakeToken().balanceOf(address(this));

        uint256 correctedBalance = tokenBalance -
            totalTokenLocked() +
            reservedRewards() -
            reservedFees();

        // Calculate all rewards paid or are claimable until now
        uint256 rewardDebt = activeAllocatedPoolShares() *
            _calculateAccRewardsPerShare(poolFactor_);

        // All fees
        uint256 rewardFee = (rewardDebt * 3) / 100;
        uint256 rewardFeeExternal = rewardFee / 2;

        uint256 availableRewards = rewardDebt - rewardFeeExternal;

        return correctedBalance - availableRewards;
    }

    function poolEntry(
        uint256 tokenId
    ) public view returns (PoolEntry memory entry) {
        return _poolEntries[tokenId];
    }

    function apy(
        uint256 duration,
        uint256 factor
    ) public pure returns (uint256 value) {
        return
            WeSenditMath.apy(
                duration,
                factor,
                maxDuration(),
                compoundInterval()
            );
    }

    function apr(
        uint256 duration,
        uint256 factor
    ) public pure returns (uint256 value) {
        return WeSenditMath.apr(duration, factor, maxDuration());
    }

    function poolFactor() public view returns (uint256 value) {
        return poolFactor(poolBalance());
    }

    function poolFactor(uint256 balance) public pure returns (uint256 value) {
        return WeSenditMath.poolFactor(balance);
    }

    function accRewardsPerShareAt(
        uint256 snapshotId
    ) public view returns (uint256 snapshotId_, uint256 snapshotValue) {
        return _accRewardsPerShareAt(snapshotId, accRewardsPerShare());
    }

    function lastRewardTimestampAt(
        uint256 snapshotId
    ) public view returns (uint256 snapshotId_, uint256 snapshotValue) {
        return _lastRewardTimestampAt(snapshotId, lastRewardTimestamp());
    }

    function maxStakingAmount() public view returns (uint256 value) {
        return _calculateMaxStakingAmount();
    }

    /**
     * Calculates accured rewards per share
     *
     * @return accRewardsPerShare_ uint256 - Accured rewards per share for given parameter
     */
    function _calculateAccRewardsPerShare()
        internal
        view
        returns (uint256 accRewardsPerShare_)
    {
        return
            _calculateAccRewardsPerShare(
                lastRewardTimestamp(),
                currentPoolFactor(),
                accRewardsPerShare()
            );
    }

    /**
     * Calculates accured rewards per share
     *
     * @param poolFactor_ uint256 - Pool factor
     *
     * @return accRewardsPerShare_ uint256 - Accured rewards per share for given parameter
     */
    function _calculateAccRewardsPerShare(
        uint256 poolFactor_
    ) internal view returns (uint256 accRewardsPerShare_) {
        return
            _calculateAccRewardsPerShare(
                lastRewardTimestamp(),
                poolFactor_,
                accRewardsPerShare()
            );
    }

    /**
     * Validates staking duration
     *
     * @param duration uint256 - Staking duration in days
     */
    function _validateStakingDuration(uint256 duration) internal pure {
        // Check for min. / max. duration
        require(
            duration >= minDuration() && duration <= maxDuration(),
            "Staking Pool: Invalid staking duration"
        );

        // Check for full week
        require(
            duration % 7 == 0,
            "Staking Pool: Staking duration needs to be a full week"
        );
    }

    /**
     * Validates staking amount
     *
     * @param amount uint256 - Amount of token to stake
     */
    function _validateStakingAmount(uint256 amount) internal view {
        // Important: check for max. staking amount before transferring token to pool
        require(
            amount <= maxStakingAmount(),
            "Staking Pool: Max. staking amount exceeded"
        );

        require(
            amount + _calculateUserStakingAmount(_msgSender()) <=
                maxStakingAmount(),
            "Staking Pool: User max. staking amount exceeded"
        );

        // CHeck allowance
        uint256 allowance = stakeToken().allowance(_msgSender(), address(this));
        require(allowance >= amount, "Staking Pool: Amount exceeds allowance");
    }

    function _validateClaim(PoolEntry memory entry) internal view {
        // Check if already unstaked
        require(
            entry.isUnstaked == false,
            "Staking Pool: Staking entry was already unstaked"
        );

        // Require entry either to be non auto-compounding or already ended
        require(
            !entry.isAutoCompoundingEnabled ||
                block.timestamp >=
                (entry.startedAt + (entry.duration * SECONDS_PER_DAY)),
            "Staking Pool: Cannot claim before staking end"
        );
    }

    function _validateUnstake(PoolEntry memory entry) internal view {
        // Check if already unstaked
        require(
            !entry.isUnstaked,
            "Staking Pool: Staking entry was already unstaked"
        );

        // Check for staking lock period
        require(
            block.timestamp >=
                entry.startedAt + (entry.duration * SECONDS_PER_DAY),
            "Staking Pool: Staking entry is locked"
        );
    }

    /**
     * Calculates "historic" rewards if we're "out" of staking
     *
     * @param shares uint256 - Staking entry shares
     * @param startTimestamp uint256 - Staking entry start timestamp
     * @param endTimestamp uint256 - Staking entry end timestamp
     *
     * @return rewards uint256 - Available rewards
     */
    function _calculateHistoricRewards(
        uint256 shares,
        uint256 startTimestamp,
        uint256 endTimestamp
    ) internal view returns (uint256 rewards) {
        // Get snapshot values
        (, uint256 lastRewardTimestampSnapshot) = lastRewardTimestampAt(
            endTimestamp
        );
        (, uint256 accRewardsPerShareSnapshot) = accRewardsPerShareAt(
            endTimestamp
        );

        if (lastRewardTimestampSnapshot > endTimestamp) {
            // Pool update was triggered after staking end

            // Calculate duration from staking start to snpashot
            uint256 elapsedSinceStart = lastRewardTimestampSnapshot -
                startTimestamp;

            // Calculate staking entry duration
            uint256 duration = endTimestamp - startTimestamp;

            // Calculate rewards based on ratio
            uint256 partialAccRewardsPerShare = (accRewardsPerShareSnapshot *
                duration) / elapsedSinceStart;

            // Calculate final rewards
            return shares * partialAccRewardsPerShare;
        } else {
            // Pool update was trigger before staking end

            // Calculate duration from lastRewardTimestampSnapshot to endTimestamp
            uint256 duration = endTimestamp - lastRewardTimestampSnapshot;

            // Calculate rewards using snapshot values and remaining duration
            return
                shares *
                _calculateAccRewardsPerShareForDuration(
                    duration,
                    lastRewardTimestampSnapshot,
                    accRewardsPerShareSnapshot
                );
        }
    }

    /**
     * Calculates accured rewards per share
     *
     * @param lastRewardTimestamp_ uint256 - Last reward timestamp
     * @param poolFactor_ uint256 - Pool factor
     * @param initialAccRewardsPerShare_ uint256 - Initial accured rewards per share
     *
     * @return accRewardsPerShare_ uint256 - Accured rewards per share for given parameter
     */
    function _calculateAccRewardsPerShare(
        uint256 lastRewardTimestamp_,
        uint256 poolFactor_,
        uint256 initialAccRewardsPerShare_
    ) private view returns (uint256 accRewardsPerShare_) {
        // Calculate seconds elapsed since last reward update
        uint256 secondsSinceLastRewards = block.timestamp -
            lastRewardTimestamp_;

        // Calculate total rewards since lastRewardTimestamp
        uint256 totalRewards = secondsSinceLastRewards * TOKEN_PER_SECOND;

        // Multiply rewards with pool factor
        uint256 currentRewards = (totalRewards * poolFactor_) / 100 ether;

        // Calculate rewards per share
        return
            initialAccRewardsPerShare_ + (currentRewards / totalPoolShares());
    }

    /**
     * Calculates accured rewards per share for custom duration
     *
     * @param duration uint256 - Duration to calculate rewards for
     * @param lastRewardTimestamp_ uint256 - Last reward timestamp
     * @param initialAccRewardsPerShare_ uint256 - Initial accured rewards per share
     *
     * @return accRewardsPerShare_ uint256 - Accured rewards per share for given parameter
     */
    function _calculateAccRewardsPerShareForDuration(
        uint256 duration,
        uint256 lastRewardTimestamp_,
        uint256 initialAccRewardsPerShare_
    ) private view returns (uint256 accRewardsPerShare_) {
        // Calculate current rewards per shares
        uint256 currentAccRewardsPerShare = _calculateAccRewardsPerShare(
            lastRewardTimestamp(),
            poolFactor(),
            accRewardsPerShare()
        );

        // Calculate difference to "historic" rewards per share
        uint256 futureAccRewardsPerShare = currentAccRewardsPerShare -
            initialAccRewardsPerShare_;

        // Calculate time difference between customLastRewardTimestamp and current block
        uint256 diff = block.timestamp - lastRewardTimestamp_;

        // Calculate rewards per share
        return
            initialAccRewardsPerShare_ +
            ((futureAccRewardsPerShare * duration) / diff);
    }

    /**
     * Calculates max. staking amount
     *
     * @return maxAmount uint256 - Max. amount of token allowed to stake
     */
    function _calculateMaxStakingAmount()
        private
        view
        returns (uint256 maxAmount)
    {
        // Get current pool balance
        uint256 balance = poolBalance();

        // Calculate upper limit (= 80% of initial balance)
        uint256 upperLimit = (INITIAL_POOL_BALANCE * 80) / 100;

        if (balance > upperLimit) {
            // If current pool balance is greater than 80% of initial balance, allow up
            // to 1_000_000 token.
            return 1_000_000 ether;
        } else {
            // If current pool balance is below or equal 80% of initial balance, allow up
            // to (1% * pool balance) token
            return (balance * 1) / 100;
        }
    }

    function _calculateUserStakingAmount(
        address addr
    ) private view returns (uint256 stakingAmount) {
        IERC721Enumerable token = IERC721Enumerable(address(proofToken()));
        uint256 balance = token.balanceOf(addr);
        uint256 amount = 0;

        for (uint256 i = 0; i < balance; i++) {
            uint256 tokenId = token.tokenOfOwnerByIndex(addr, i);
            amount += _poolEntries[tokenId].amount;
        }

        return amount;
    }
}
