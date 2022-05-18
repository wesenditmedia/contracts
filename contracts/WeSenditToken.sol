// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract WeSenditToken is ERC20, ERC20Capped, ERC20Burnable, Ownable {
    using SafeMath for uint256;

    uint256 public constant INITIAL_SUPPLY = 37500000 * 1 ether;
    uint256 public constant TOTAL_SUPPLY = 1500000000 * 1 ether;

    // Pancake Router Address
    address public pancakeRouterAddress =
        address(0x10ED43C718714eb63d5aA57B78B54704E256024E);

    address public activityPoolAddress = address(0);
    address public referralPoolAddress = address(0);
    address public stakingPoolAddress = address(0);

    bool public feesEnabled = true;
    uint256 public minTxAmount = 0;

    constructor(address tgeWallet)
        ERC20("WeSendit", "WSI")
        ERC20Capped(TOTAL_SUPPLY)
    {
        ERC20._mint(tgeWallet, INITIAL_SUPPLY);
        ERC20._mint(address(this), TOTAL_SUPPLY.sub(INITIAL_SUPPLY));
    }

    function setPancakeRouter(address addr) external onlyOwner {
        pancakeRouterAddress = addr;
    }

    function setActivityPoolAddress(address addr) external onlyOwner {
        activityPoolAddress = addr;
    }

    function setReferralPoolAddress(address addr) external onlyOwner {
        referralPoolAddress = addr;
    }

    function setStakingPoolAddress(address addr) external onlyOwner {
        stakingPoolAddress = addr;
    }

    function setMinTxAmount(uint256 amount) external onlyOwner {
        minTxAmount = amount;
    }

    function setFeesEnabled(bool value) external onlyOwner {
        feesEnabled = value;
    }

    function distributeSaleToken(
        address seedSaleWallet,
        address privateSaleWallet
    ) external onlyOwner {
        _transfer(address(this), seedSaleWallet, 75000000 * 1 ether); // 5%
        _transfer(address(this), privateSaleWallet, 120000000 * 1 ether); // 8%
    }

    function distributeToken(
        address teamWallet,
        address advisorsWallet,
        address referralsWallet,
        address developmentWallet,
        address marketingWallet,
        address operationsWallet,
        address exchangeAndLiquidityWallet,
        address stakingRewardsWallet,
        address activityRewardsWallet,
        address airdropWallet,
        address generalReserveWallet
    ) external onlyOwner {
        _transfer(address(this), teamWallet, 180000000 * 1 ether); // 12%
        _transfer(address(this), advisorsWallet, 75000000 * 1 ether); // 5%
        _transfer(address(this), referralsWallet, 75000000 * 1 ether); // 5%
        _transfer(address(this), developmentWallet, 225000000 * 1 ether); // 15%
        _transfer(address(this), marketingWallet, 180000000 * 1 ether); // 12%
        _transfer(address(this), operationsWallet, 150000000 * 1 ether); // 10%
        _transfer(
            address(this),
            exchangeAndLiquidityWallet,
            120000000 * 1 ether
        ); // 8%
        _transfer(address(this), stakingRewardsWallet, 120000000 * 1 ether); // 8%
        _transfer(address(this), activityRewardsWallet, 45000000 * 1 ether); // 3%
        _transfer(address(this), airdropWallet, 45000000 * 1 ether); // 3%
        _transfer(address(this), generalReserveWallet, 52500000 * 1 ether); // 3.5%
    }

    function transfer(address to, uint256 amount)
        public
        virtual
        override
        returns (bool)
    {
        require(
            amount >= minTxAmount,
            "WeSendit: amount is less than minTxAmount"
        );

        address owner = _msgSender();
        uint256 tTotal = _reflectFees(owner, to, amount);

        _transfer(owner, to, tTotal);

        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public virtual override returns (bool) {
        require(
            amount >= minTxAmount,
            "WeSendit: amount is less than minTxAmount"
        );

        address spender = _msgSender();

        _spendAllowance(from, spender, amount);

        uint256 tTotal = _reflectFees(from, to, amount);
        _transfer(from, to, tTotal);

        return true;
    }

    function _reflectFees(
        address from,
        address to,
        uint256 amount
    ) internal returns (uint256 _tTotal) {
        if (!feesEnabled) {
            return amount;
        }

        uint256 tTotal = amount;

        // only apply fee if sender / receiver is not pancake router
        if (from != pancakeRouterAddress && to != pancakeRouterAddress) {
            uint256 tFeeActivityPool = 0;
            uint256 tFeeReferralPool = 0;
            uint256 tFeeStakingPool = 0;

            if (activityPoolAddress != address(0)) {
                tFeeActivityPool = tTotal.mul(75).div(10000); // 0.75%
                _transfer(from, activityPoolAddress, tFeeActivityPool);
            }

            if (referralPoolAddress != address(0)) {
                tFeeReferralPool = tTotal.mul(75).div(10000); // 0.75%
                _transfer(from, referralPoolAddress, tFeeReferralPool);
            }

            if (stakingPoolAddress != address(0)) {
                tFeeStakingPool = tTotal.mul(15).div(1000); // 1.5%
                _transfer(from, stakingPoolAddress, tFeeStakingPool);
            }

            tTotal = tTotal.sub(tFeeActivityPool).sub(tFeeReferralPool).sub(
                tFeeStakingPool
            );
        }

        require(tTotal > 0, "Invalid transaction amount");

        return tTotal;
    }

    function emergencyWithdraw(address receiver) external onlyOwner {
        _transfer(address(this), receiver, balanceOf(address(this)));
    }

    function _mint(address account, uint256 amount)
        internal
        virtual
        override(ERC20, ERC20Capped)
    {
        super._mint(account, amount);
    }
}
