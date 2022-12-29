// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "./EmergencyGuard.sol";
import "./interfaces/IStakingPool.sol";
import "./utils/WeSenditMath.sol";
import "./utils/Trigonometry.sol";
import "./interfaces/IWeStakeitToken.sol";

abstract contract BaseStakingPool is
    IStakingPool,
    EmergencyGuard,
    Ownable,
    AccessControlEnumerable,
    ReentrancyGuard
{
    uint256 private _currentPoolFactor;
    uint256 private _lastRewardBlock;
    uint256 private _allocatedPoolShares;
    uint256 private _accumulatedRewardsPerShare;

    IERC20 private _token = IERC20(address(0));
    IWeStakeitToken private _stakingToken = IWeStakeitToken(address(0));

    mapping(uint256 => PoolEntry) _poolEntries;

    modifier onlyTokenOwner(uint256 tokenId) {
        require(
            stakingToken().ownerOf(tokenId) == _msgSender(),
            "StakingPool: Caller is not entry owner"
        );
        _;
    }

    function currentPoolFactor() public view returns (uint256 value) {
        return _currentPoolFactor;
    }

    function lastRewardBlock() public view returns (uint256 value) {
        return _lastRewardBlock;
    }

    function totalPoolShares() public pure returns (uint256 value) {
        return 120_000_000 ether;
    }

    function allocatedPoolShares() public view returns (uint256 value) {
        return _allocatedPoolShares;
    }

    function maxDuration() public pure returns (uint256 value) {
        return 364; // 52 weeks
    }

    function compoundInterval() public pure returns (uint256 value) {
        return 730;
    }

    function token() public view returns (IERC20 value) {
        return _token;
    }

    function stakingToken() public view returns (IWeStakeitToken value) {
        return _stakingToken;
    }

    function poolBalance() public view returns (uint256 value) {
        // return token().balanceOf(address(this));
        return 120_000_000 ether;
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

    function stake(
        uint256 amount,
        uint256 duration,
        bool enableAutoCompounding
    ) public returns (uint256 value) {
        uint256 multiplier;

        if (enableAutoCompounding) {
            multiplier = apy(duration);
        } else {
            multiplier = apr(duration);
        }

        uint256 totalShares = amount * multiplier;
        _allocatedPoolShares += totalShares;

        PoolEntry memory entry = PoolEntry(
            amount,
            duration,
            totalShares,
            0,
            block.timestamp,
            block.number,
            enableAutoCompounding
        );

        // Mint NFT
        // TODO: add NFT metadata
        uint256 tokenId = stakingToken().mint(_msgSender());
        _poolEntries[tokenId] = entry;

        // Trigger pool update
        updatePool();
    }

    function unstake(uint256 tokenId) public onlyTokenOwner(tokenId) {
        PoolEntry memory entry = _poolEntries[tokenId];

        stakingToken().burn(tokenId);

        // Check for staking timestamp
        // Force payout rewards
        // Remove entry from list
        // Fee

        _allocatedPoolShares -= entry.shares;

        // Trigger pool update
        updatePool();
    }

    function pendingRewards(
        uint256 tokenId
    ) public view returns (uint256 value) {
        PoolEntry memory entry = _poolEntries[tokenId];

        uint256 totalRewards = entry.shares * _accumulatedRewardsPerShare;

        // Fee

        return totalRewards - entry.claimedRewards;
    }

    function updatePool() public {
        if (lastRewardBlock() >= block.number) {
            return;
        }

        if (allocatedPoolShares() == 0) {
            return;
        }

        // Calculate rewards for last reward period (since last updatePool call)
        uint256 blocksSinceLastRewards = block.number - lastRewardBlock();
        uint256 totalAccumulatedRewards = (blocksSinceLastRewards *
            allocatedPoolShares() *
            currentPoolFactor()) / 1e18;

        // Calculate global rewards per share
        _accumulatedRewardsPerShare +=
            totalAccumulatedRewards /
            allocatedPoolShares();

        // Update pool factor
        _currentPoolFactor = poolFactor(poolBalance());
    }
}
