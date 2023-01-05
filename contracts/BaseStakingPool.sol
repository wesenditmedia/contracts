// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Arrays.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

import "./EmergencyGuard.sol";
import "./interfaces/IStakingPool.sol";
import "./utils/WeSenditMath.sol";
import "./utils/Trigonometry.sol";
import "./interfaces/IWeStakeitToken.sol";

import "hardhat/console.sol";

abstract contract BaseStakingPool is
    IStakingPool,
    EmergencyGuard,
    Ownable,
    AccessControlEnumerable,
    ReentrancyGuard
{
    using Arrays for uint256[];
    using Counters for Counters.Counter;

    // Token per block multiplied by 100 = max. 200% APY
    uint256 public constant TOKEN_PER_BLOCK = 11.56 ether;

    // Seconds per day
    uint256 internal constant SECONDS_PER_DAY = 86400;

    // Seconds per hour
    uint256 internal constant SECONDS_PER_HOUR = 3600;

    // Current pool factor, updated on every updatePool() call
    uint256 internal _currentPoolFactor;

    // Last block rewards were calculated at, updated on every updatePool() call
    uint256 internal _lastRewardBlock;

    // Amount of allocated pool shares
    uint256 internal _allocatedPoolShares;

    // Amount of accured rewards per share, updated on every updatePool() call
    uint256 internal _accRewardsPerShare;

    // Amount of allocated pool rewards, updated on every updatePool() call
    uint256 internal _allocatedPoolRewards;

    // Total amount of locked token (excluding rewards)
    uint256 internal _totalTokenLocked;

    struct Snapshots {
        uint256[] ids;
        uint256[] values;
    }

    Counters.Counter private _currentSnapshotId;
    Snapshots internal _accRewardsPerShareSnapshots;
    Snapshots internal _poolFactorSnapshots;

    function _snapshot() internal virtual returns (uint256) {
        _currentSnapshotId.increment();

        uint256 currentId = _getCurrentSnapshotId();
        return currentId;
    }

    function _getCurrentSnapshotId() internal view virtual returns (uint256) {
        return block.number;
    }

    function _valueAt(
        uint256 snapshotId,
        Snapshots storage snapshots
    ) private view returns (bool, uint256, uint256) {
        require(snapshotId > 0, "ERC20Snapshot: id is 0");
        require(
            snapshotId <= _getCurrentSnapshotId(),
            "ERC20Snapshot: nonexistent id"
        );

        // When a valid snapshot is queried, there are three possibilities:
        //  a) The queried value was not modified after the snapshot was taken. Therefore, a snapshot entry was never
        //  created for this id, and all stored snapshot ids are smaller than the requested one. The value that corresponds
        //  to this id is the current one.
        //  b) The queried value was modified after the snapshot was taken. Therefore, there will be an entry with the
        //  requested id, and its value is the one to return.
        //  c) More snapshots were created after the requested one, and the queried value was later modified. There will be
        //  no entry for the requested id: the value that corresponds to it is that of the smallest snapshot id that is
        //  larger than the requested one.
        //
        // In summary, we need to find an element in an array, returning the index of the smallest value that is larger if
        // it is not found, unless said value doesn't exist (e.g. when all values are smaller). Arrays.findUpperBound does
        // exactly this.
        uint256 index = snapshots.ids.findUpperBound(snapshotId);

        if (index == snapshots.ids.length) {
            return (false, 0, 0);
        } else {
            return (true, snapshots.ids[index], snapshots.values[index]);
        }
    }

    function _accRewardsPerShareAt(
        uint256 snapshotId
    ) public view virtual returns (uint256, uint256) {
        (bool snapshotted, uint256 id, uint256 value) = _valueAt(
            snapshotId,
            _accRewardsPerShareSnapshots
        );

        return (id, snapshotted ? value : _accRewardsPerShare);
    }

    function _poolFactorAt(
        uint256 snapshotId
    ) public view virtual returns (uint256, uint256) {
        (bool snapshotted, uint256 id, uint256 value) = _valueAt(
            snapshotId,
            _poolFactorSnapshots
        );

        return (id, snapshotted ? value : _currentPoolFactor);
    }

    function _updateSnapshot(
        Snapshots storage snapshots,
        uint256 currentValue
    ) internal {
        uint256 currentId = _getCurrentSnapshotId();
        if (_lastSnapshotId(snapshots.ids) < currentId) {
            snapshots.ids.push(currentId);
            snapshots.values.push(currentValue);
        }
    }

    function _lastSnapshotId(
        uint256[] storage ids
    ) private view returns (uint256) {
        if (ids.length == 0) {
            return 0;
        } else {
            return ids[ids.length - 1];
        }
    }

    // Token used for staking
    IERC20 private _stakeToken = IERC20(address(0));

    // Token used as staking reward
    IWeStakeitToken private _rewardToken = IWeStakeitToken(address(0));

    // Mapping of reward token to staking entry
    mapping(uint256 => PoolEntry) internal _poolEntries;

    // Checks if tokenId owner equals sender
    modifier onlyTokenOwner(uint256 tokenId) {
        require(
            rewardToken().ownerOf(tokenId) == _msgSender(),
            "Staking Pool: Caller is not entry owner"
        );
        _;
    }

    constructor(address stakeTokenAddress, address rewardTokenAddress) {
        _stakeToken = IERC20(stakeTokenAddress);
        _rewardToken = IWeStakeitToken(rewardTokenAddress);

        // Initially calculate pool factor
        _currentPoolFactor = poolFactor(poolBalance());
    }

    function currentPoolFactor() public view returns (uint256 value) {
        return _currentPoolFactor;
    }

    function lastRewardBlock() public view returns (uint256 value) {
        return _lastRewardBlock;
    }

    function allocatedPoolShares() public view returns (uint256 value) {
        return _allocatedPoolShares;
    }

    function totalPoolShares() public pure returns (uint256 value) {
        return 120_000_000 * 1e2;
    }

    function maxPoolSharesPerUser() public view returns (uint256 value) {
        // TODO
    }

    function totalTokenLocked() public view returns (uint256 value) {
        return _totalTokenLocked;
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

    function rewardToken() public view returns (IWeStakeitToken value) {
        return _rewardToken;
    }

    function poolBalance() public view returns (uint256 value) {
        // return token().balanceOf(address(this));

        // TODO: multiply rewards with pool factor
        // TODO: handle acc rewards
        // TODO: switch to getters
        return 120_000_000 ether - _allocatedPoolRewards - totalTokenLocked();
    }

    function poolEntry(
        uint256 tokenId
    ) public view returns (PoolEntry memory entry) {
        return _poolEntries[tokenId];
    }

    function apy(uint256 duration) public view returns (uint256 value) {
        return apy(duration, poolFactor(poolBalance()));
    }

    function apy(
        uint256 duration,
        uint256 factor
    ) public pure returns (uint256 value) {
        // Handle overflow
        if (duration > maxDuration()) {
            duration = maxDuration();
        }

        uint256 _roi = 11 * 1e4; // 110%
        uint256 _poolFactor = factor / 1e14;
        uint256 _compoundInterval = compoundInterval() * 1e4;
        uint256 _duration = duration * 1e7;
        uint256 _maxDuration = maxDuration() * 1e4;

        uint256 x = 1e7 + (_roi * _poolFactor) / _compoundInterval;
        uint256 y = _compoundInterval * (_duration / _maxDuration);
        uint256 pow = WeSenditMath.power(x, y / 1e7, 7);

        return pow - 1e7;
    }

    function apr(uint256 duration) public view returns (uint256 value) {
        return apr(duration, poolFactor(poolBalance()));
    }

    function apr(
        uint256 duration,
        uint256 factor
    ) public pure returns (uint256 value) {
        // Handle overflow
        if (duration > maxDuration()) {
            duration = maxDuration();
        }

        uint256 _roi = 11 * 1e4; // 110%
        uint256 _poolFactor = factor / 1e14;
        uint256 _duration = duration * 1e7;
        uint256 _maxDuration = maxDuration() * 1e4;

        uint256 x = _roi * _poolFactor;
        uint256 y = _duration / _maxDuration;

        return (x * y) / 1e7;
    }

    function poolFactor(uint256 balance) public pure returns (uint256 value) {
        uint256 pMax = 120_000_000 ether;
        uint256 pMin = 0;

        // Handle overflow
        if (balance > pMax) {
            balance = pMax;
        }

        uint256 PI = Trigonometry.PI; // / 1e13;
        uint256 bracketsOne = (pMax / 1e13) - (balance / 1e13);
        uint256 bracketsTwo = (pMax / 1e18) - (pMin / 1e18);
        uint256 division = bracketsOne / bracketsTwo;
        uint256 bracketsCos = (PI * division) / 1e5;

        uint256 cos;
        uint256 brackets;
        if (bracketsCos >= Trigonometry.PI_OVER_TWO) {
            cos = uint256(Trigonometry.cos(bracketsCos + Trigonometry.PI));
            brackets = (cos + 1e18) / (2 * 1e1);
            // Subtract cos result from brackets result, since we shifted the cos input by PI
            brackets -= (cos / 1e1);
        } else {
            cos = uint256(Trigonometry.cos(bracketsCos));
            brackets = (cos + 1e18) / (2 * 1e1);
        }

        uint256 result = brackets * (100 - 15) + (15 * 1e17);

        return result * 1e1;
    }

    function _calculateAccRewardsPerShare()
        internal
        view
        returns (uint256 accRewardsPerShare)
    {
        uint256 blocksSinceLastRewards = block.number - lastRewardBlock();

        // Calculate total rewards since lastRewardBlock
        uint256 totalRewards = blocksSinceLastRewards * TOKEN_PER_BLOCK;

        // Multiply rewards with pool factor
        uint256 currentRewards = (totalRewards * 1e5) /
            (currentPoolFactor() / 1e15);

        // Calculate rewards per share
        return _accRewardsPerShare + (currentRewards / totalPoolShares());
    }

    function _calculateAccRewardsPerShare(
        uint256 blockCount,
        uint256 poolFactor
    ) internal view returns (uint256 value) {
        uint256 blocksSinceLastRewards = block.number - lastRewardBlock();
1
        // Calculate total rewards since lastRewardBlock
        uint256 totalRewards = blocksSinceLastRewards * TOKEN_PER_BLOCK;

        // Multiply rewards with pool factor
        uint256 currentRewards = (totalRewards * 1e5) / (poolFactor / 1e15);

        // Calculate rewards per share
        return _accRewardsPerShare + (currentRewards / totalPoolShares());
    }

    function emergencyWithdraw(uint256 amount) external override onlyOwner {
        super._emergencyWithdraw(amount);
    }

    function emergencyWithdrawToken(
        address token,
        uint256 amount
    ) external override onlyOwner {
        super._emergencyWithdrawToken(token, amount);
    }
}
